/**
 * UNIT — materializeProfile() writer, after the
 * consolidate-profile-tools-to-the-singleton-surface re-scope (tier: unit, real
 * temp dir via the SIL_DATA_DIR override, no network, no host).
 *
 * The caller-supplied `agentId` is DROPPED: the store re-scopes to a fixed
 * SINGLETON path (a compile-time constant sub-dir of `$SIL_DATA_DIR`, NOT caller
 * input). ONE persistent "sil shopper" owns ONE dir holding a SHARED user_spec.md +
 * profile.json, with niche packs under domains/<slug>/:
 *
 *   $SIL_DATA_DIR/<SHOPPER_SUBDIR>/
 *     ├─ user_spec.md            SHARED, agent-level (the one person).
 *     ├─ profile.json            manifest: name + userSpecPath + a `domains` MAP.
 *     └─ domains/<slug>/
 *         ├─ domain_spec.md      per-domain pack (researched niche expertise)
 *         ├─ intent_spec.md      per-domain pack (decomposition dimensions)
 *         └─ playbook.md         per-domain pack (niche buying taste)
 *
 * `ProfileSpec` reshapes to agent-level fields + an OPTIONAL `domain` pack, with NO
 * `agentId`:
 *   { name, userSpec, domain?: { slug, name, domainSpec, intentSpec, playbook } }
 *   - NO `domain`  ⇒ CREATE the shopper (shared user_spec.md + `domains: {}`).
 *   - WITH `domain` ⇒ lazily MINT/refresh: write domains/<slug>/*, overwrite the
 *     shared user_spec.md, upsert `domains[slug]` — one atomic call.
 *
 * This file pins the GENERIC writer invariants that survive the re-scope — the
 * SINGLETON path-safety property (the keying segment is an un-spoofable constant,
 * NOT caller input — so the agentId traversal vector is structurally eliminated),
 * the NEW slug path-segment gate (KEPT — the slug is still caller-supplied),
 * validate-first, atomicity on a blocked path, the 0600/0700 modes, no-token-
 * coupling, the resolved-from-getDataDir() dir. The deeper layout / lazy-mint /
 * domains-map semantics live in `profile-store-sds.test.ts`; the read/remove
 * primitives in `profile-store-manage.test.ts`.
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (the repo's standard knob).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  materializeProfile,
  getShopperArtefactDir,
  getDomainArtefactDir,
  type ProfileSpec,
} from "../../lib/profile-store.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-profile-store-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    /* best-effort */
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/** The shared, agent-level user spec — the one person, carried across niches. */
const USER_SPEC =
  "# User spec — the shopper (shared, agent-level)\n"
  + "## Standing facts\n- Ships to Berlin 10115.\n- Inseam 81cm, shoe EU 43.\n"
  + "## Hard constraints (INVIOLABLE across every niche)\n"
  + "- HARD-NO: leather (ethics).\n- HARD-NO: anything over budget without a flag.";

/** A complete domain pack (the per-niche artefacts, minted lazily on first shop). */
const DOMAIN = {
  slug: "road-cycling",
  name: "Road cycling",
  domainSpec:
    "# Road-cycling domain spec (deep)\nFit mechanics, gearing theory, frame"
    + " geometry, the full bike-fit process. Trade-offs noted.",
  intentSpec:
    "# Intent spec — decomposition dimensions\nuse-case, terrain, budget, timeline,"
    + " compatibility, performance priorities, aesthetics.",
  playbook:
    "# Buying taste (road cycling)\nBudget band ~€1500; distrusts house-brand"
    + " groupsets; Shimano over SRAM.",
} as const;

/** Create the singleton shopper (no domain, no agentId): the one-time agent-level write. */
const CREATE_SHOPPER = {
  name: "sil shopper",
  userSpec: USER_SPEC,
} as const;

/** Mint a niche onto the shopper (lazy, shop-time). */
const MINT = {
  ...CREATE_SHOPPER,
  domain: DOMAIN,
} as const;

/** Raw, untyped manifest read — decoupled from the manifest field shape so a
 * RED run against the un-reshaped store never throws on a missing key. */
function readManifest(): Record<string, unknown> {
  const path = join(getShopperArtefactDir(), "profile.json");
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** Every file under `dir`, recursively (relative paths). */
function walkFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

// ===========================================================================
// SINGLETON path-safety — the keying segment is a constant, NOT caller input
// ===========================================================================

describe("singleton path-safety — the shopper dir segment is an un-spoofable constant, not caller input", () => {
  it("getShopperArtefactDir() resolves a SINGLE fixed segment directly under getDataDir() (honours $SIL_DATA_DIR)", () => {
    const dir = getShopperArtefactDir();
    // Resolved from getDataDir() — never hardcoded.
    expect(dir.startsWith(getDataDir())).toBe(true);
    // Exactly ONE path segment below the data dir — the shopper sub-dir.
    expect(dirname(dir)).toBe(getDataDir());
    // The segment is a safe, traversal-free constant (lower-kebab, no separators,
    // no `..`/`.`), so there is no caller-controlled component to spoof.
    const seg = basename(dir);
    expect(seg).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(seg).not.toContain("..");
  });

  it("is STABLE — there is no argument that can change the shopper segment (the agentId vector is gone)", () => {
    // The function takes NO argument; two calls yield the identical, constant path.
    expect(getShopperArtefactDir()).toBe(getShopperArtefactDir());
  });

  it("getDomainArtefactDir(slug) keys off the constant shopper dir — the slug is the ONLY caller segment", () => {
    expect(getDomainArtefactDir("road-cycling")).toBe(
      join(getShopperArtefactDir(), "domains", "road-cycling"),
    );
  });
});

describe("materializeProfile — create the shopper (no domain): shared user_spec + empty domains map", () => {
  it("writes ONLY user_spec.md + profile.json at the agent level; NO domains/ dir yet", () => {
    const result = materializeProfile({ ...CREATE_SHOPPER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dir = getShopperArtefactDir();
    expect(result.dir).toBe(dir);
    expect(existsSync(join(dir, "user_spec.md"))).toBe(true);
    expect(existsSync(join(dir, "profile.json"))).toBe(true);
    // The per-niche flat artefacts are GONE from the agent level.
    expect(existsSync(join(dir, "domain_spec.md"))).toBe(false);
    expect(existsSync(join(dir, "intent_spec.md"))).toBe(false);
    expect(existsSync(join(dir, "playbook.md"))).toBe(false);
    // A freshly-created shopper has shopped nothing — no domains/ subtree.
    expect(existsSync(join(dir, "domains"))).toBe(false);

    // Exactly the two agent-level files.
    expect(walkFiles(dir).sort()).toEqual(["profile.json", "user_spec.md"].sort());
    expect(readFileSync(join(dir, "user_spec.md"), "utf8")).toBe(USER_SPEC);
  });

  it("the ok result surfaces userSpecPath + profilePath (and NO old flat *Path fields, NO agentId)", () => {
    const result = materializeProfile({ ...CREATE_SHOPPER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dir = getShopperArtefactDir();
    expect(result.userSpecPath).toBe(join(dir, "user_spec.md"));
    expect(result.profilePath).toBe(join(dir, "profile.json"));
    // The caller-supplied agentId is gone from the result surface too.
    expect("agentId" in result).toBe(false);
    // The four flat spec paths left the result — they are per-domain now.
    expect("domainSpecPath" in result).toBe(false);
    expect("intentSpecPath" in result).toBe(false);
    expect("playbookPath" in result).toBe(false);
  });

  it("the manifest carries name + userSpecPath + an EMPTY domains map (no flat *Path keys)", () => {
    materializeProfile({ ...CREATE_SHOPPER });
    const manifest = readManifest();
    const dir = getShopperArtefactDir();
    expect(manifest["name"]).toBe(CREATE_SHOPPER.name);
    expect(manifest["userSpecPath"]).toBe(join(dir, "user_spec.md"));
    // domains is the source of truth — present, an object, and EMPTY (healthy).
    expect(manifest["domains"]).toEqual({});
    expect(typeof manifest["createdAt"]).toBe("string");
    expect(Number.isNaN(Date.parse(manifest["createdAt"] as string))).toBe(false);
    // The four flat spec-path keys are GONE from the manifest.
    expect("domainSpecPath" in manifest).toBe(false);
    expect("intentSpecPath" in manifest).toBe(false);
    expect("playbookPath" in manifest).toBe(false);
  });

  it("writes the shared user_spec + manifest owner-only (0600) inside a 0700 dir", () => {
    const result = materializeProfile({ ...CREATE_SHOPPER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(statSync(result.dir).mode & 0o777).toBe(0o700);
    expect(statSync(result.userSpecPath).mode & 0o777).toBe(0o600);
    expect(statSync(result.profilePath).mode & 0o777).toBe(0o600);
  });

  it("does NOT read or write any token (no identity coupling)", () => {
    materializeProfile({ ...CREATE_SHOPPER });
    expect(existsSync(getTokensPath())).toBe(false);
  });

  it("leaves NO .tmp sibling behind after the atomic write", () => {
    const result = materializeProfile({ ...CREATE_SHOPPER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(walkFiles(result.dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});

describe("materializeProfile — mint a niche (with domain): the pack lands under domains/<slug>/", () => {
  it("writes domains/<slug>/{domain_spec,intent_spec,playbook}.md owner-only, and upserts domains[slug]", () => {
    // Create the shopper first (the intended flow), then mint the niche.
    expect(materializeProfile({ ...CREATE_SHOPPER }).ok).toBe(true);
    const result = materializeProfile({ ...MINT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const domainDir = getDomainArtefactDir(DOMAIN.slug);
    expect(readFileSync(join(domainDir, "domain_spec.md"), "utf8")).toBe(DOMAIN.domainSpec);
    expect(readFileSync(join(domainDir, "intent_spec.md"), "utf8")).toBe(DOMAIN.intentSpec);
    expect(readFileSync(join(domainDir, "playbook.md"), "utf8")).toBe(DOMAIN.playbook);
    // Per-domain pack files are owner-only.
    expect(statSync(join(domainDir, "domain_spec.md")).mode & 0o777).toBe(0o600);

    // The manifest's domains map gains the slug, with the three per-domain paths.
    const domains = (readManifest()["domains"] ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    expect(domains[DOMAIN.slug]).toBeDefined();
    expect(domains[DOMAIN.slug]!["slug"]).toBe(DOMAIN.slug);
    expect(domains[DOMAIN.slug]!["name"]).toBe(DOMAIN.name);
    expect(domains[DOMAIN.slug]!["domainSpecPath"]).toBe(join(domainDir, "domain_spec.md"));
    expect(domains[DOMAIN.slug]!["intentSpecPath"]).toBe(join(domainDir, "intent_spec.md"));
    expect(domains[DOMAIN.slug]!["playbookPath"]).toBe(join(domainDir, "playbook.md"));
    expect(typeof domains[DOMAIN.slug]!["createdAt"]).toBe("string");
    expect(typeof domains[DOMAIN.slug]!["updatedAt"]).toBe("string");
  });

  it("the ok result echoes the minted domain entry (slug + the three per-domain paths)", () => {
    expect(materializeProfile({ ...CREATE_SHOPPER }).ok).toBe(true);
    const result = materializeProfile({ ...MINT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBeDefined();
    expect(result.domain!.slug).toBe(DOMAIN.slug);
    const domainDir = getDomainArtefactDir(DOMAIN.slug);
    expect(result.domain!.domainSpecPath).toBe(join(domainDir, "domain_spec.md"));
    expect(result.domain!.intentSpecPath).toBe(join(domainDir, "intent_spec.md"));
    expect(result.domain!.playbookPath).toBe(join(domainDir, "playbook.md"));
  });
});

describe("materializeProfile — validate-first on the agent-level fields (writes NOTHING)", () => {
  const dirExists = () => existsSync(getShopperArtefactDir());

  it("blank name → invalid_request(field=name), nothing written", () => {
    const result = materializeProfile({ ...CREATE_SHOPPER, name: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("name");
    expect(dirExists()).toBe(false);
  });

  it("missing userSpec → invalid_request(field=userSpec), nothing written (userSpec is REQUIRED on EVERY call)", () => {
    const { userSpec: _u, ...noUser } = CREATE_SHOPPER;
    const result = materializeProfile(noUser as unknown as ProfileSpec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("userSpec");
    expect(dirExists()).toBe(false);
  });

  it("present-but-blank userSpec → invalid_request(field=userSpec), nothing written", () => {
    const result = materializeProfile({ ...CREATE_SHOPPER, userSpec: "  \t\n " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("userSpec");
    expect(dirExists()).toBe(false);
  });
});

describe("materializeProfile — atomic on a blocked path (persistence_failed, nothing partial)", () => {
  it("when the shopper dir path is blocked by a regular file → persistence_failed, the file untouched", () => {
    const shopperDir = getShopperArtefactDir();
    mkdirSync(dirname(shopperDir), { recursive: true });
    // Place a regular file exactly where the shopper DIR must go.
    writeFileSync(shopperDir, "i am a file, not a dir");

    const result = materializeProfile({ ...CREATE_SHOPPER });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("persistence_failed");
    if (result.kind !== "persistence_failed") return;
    expect(result.error).toContain(shopperDir);
    expect(statSync(shopperDir).isFile()).toBe(true);
  });
});
