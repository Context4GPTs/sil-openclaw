/**
 * UNIT — the single-multi-domain shopper layout, the DEEP store semantics (tier:
 * unit, real temp dir via the SIL_DATA_DIR override, no network, no host).
 *
 * Card: single-multi-domain-sil-shopper — Slice 1. The per-niche flat layout is
 * DELETED. ONE shopper dir holds a SHARED agent-level user_spec.md + profile.json
 * (with a slug-keyed `domains` MAP), and niche packs live under
 * domains/<slug>/{domain_spec,intent_spec,playbook}.md, minted LAZILY on first
 * shop. `sil_profile_materialize` stays ONE tool with an OPTIONAL `domain`:
 *   - no domain  ⇒ create the shopper (shared user_spec + `domains: {}`);
 *   - with domain ⇒ ATOMIC lazy mint of domains/<slug>/* + a shared-user_spec
 *     full-body rewrite + an upsert into `domains[slug]`.
 *
 * This file pins the layout-specific contract for `src/lib/profile-store.ts`:
 *   1. SHARED vs PER-DOMAIN placement — user_spec is agent-level (read by every
 *      domain's loop, so a fact stored in niche A is reused in niche B without
 *      re-asking); the playbook/domain_spec/intent_spec are per-domain. A domain
 *      mint NEVER touches a sibling domain's pack.
 *   2. The `domains` map is the source of truth — slug-keyed, each entry carrying
 *      { slug, name, domainSpecPath, intentSpecPath, playbookPath, createdAt,
 *      updatedAt }. `domains: {}` is the HEALTHY freshly-created state.
 *   3. The slug is a NEW filesystem path segment → it MUST be validated exactly
 *      like agentId (AGENT_ID_RE + non-"main") BEFORE any join. A traversal /
 *      "main" / empty / non-kebab slug → invalid_request(field=domain.slug),
 *      writing NOTHING (validate-first). Every one of the five `domain` fields is
 *      REQUIRED non-blank.
 *   4. ATOMICITY one level deeper — write order: domains/<slug>/* → shared
 *      user_spec → profile.json LAST. A failed FIRST mint of a NEW domain tears
 *      down ONLY that leaf (the agent dir, shared user_spec, and sibling domains
 *      survive). A crash before the profile.json write leaves an ORPHANED,
 *      unreferenced leaf — invisible to readers (manifest-gated, fail-closed).
 *   5. FAIL-CLOSED reads — readAgentProfile(agentId, slug) returns not_found when
 *      the shared user_spec OR ANY of the 3 referenced domain bodies is missing
 *      (never a partial pack).
 *
 * Hermetic via the SIL_DATA_DIR temp-dir override (mirrors profile-store.test.ts).
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
  chmodSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeProfile,
  readAgentProfile,
  listAgentProfiles,
  getAgentArtefactDir,
  type ProfileSpec,
} from "../../lib/profile-store.js";
import { getDataDir } from "../../lib/credentials.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-shopper-sds-"));
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

const AGENT_ID = "sil-shopper";

const USER_SPEC_V1 =
  "# User spec (shared)\n## Standing facts\n- Ships to Berlin 10115.\n"
  + "## Hard constraints\n- HARD-NO: leather (ethics).";

/** A cross-niche fact added while shopping niche A — must be reusable in niche B. */
const USER_SPEC_V2 =
  USER_SPEC_V1 + "\n- Allergic to wool (added while shopping cycling kit).";

const CYCLING = {
  slug: "road-cycling",
  name: "Road cycling",
  domainSpec: "# Road-cycling domain spec\nFit, gearing, geometry.",
  intentSpec: "# Intent spec — cycling\nuse-case, terrain, budget, timeline.",
  playbook: "# Taste — cycling\n~€1500; Shimano over SRAM.",
} as const;

const RUNNING = {
  slug: "running-shoes",
  name: "Running shoes",
  domainSpec: "# Running-shoe domain spec\nLast shape, stack, drop, foam.",
  intentSpec: "# Intent spec — running\nsurface, distance, gait, budget.",
  playbook: "# Taste — running\nUnder €160; neutral foam; no carbon plate.",
} as const;

/** Create the shopper (no domain). */
function createShopper(userSpec = USER_SPEC_V1): void {
  const r = materializeProfile({ agentId: AGENT_ID, name: "sil shopper", userSpec });
  if (!r.ok) throw new Error(`createShopper failed: ${JSON.stringify(r)}`);
}

/** Mint a domain pack onto the shopper, carrying a (possibly augmented) shared spec. */
function mint(domain: ProfileSpec["domain"], userSpec = USER_SPEC_V1): void {
  const r = materializeProfile({ agentId: AGENT_ID, name: "sil shopper", userSpec, domain });
  if (!r.ok) throw new Error(`mint failed: ${JSON.stringify(r)}`);
}

function readManifest(agentId = AGENT_ID): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(getAgentArtefactDir(agentId), "profile.json"), "utf8"),
  ) as Record<string, unknown>;
}

function domainDir(slug: string, agentId = AGENT_ID): string {
  return join(getAgentArtefactDir(agentId), "domains", slug);
}

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
// 1 — shared user_spec is agent-level; per-domain packs are isolated
// ===========================================================================

describe("layout — the shared user_spec is agent-level; a domain mint never touches a sibling", () => {
  it("a fact written to the shared user_spec while minting niche A is read back when viewing niche B (no re-ask)", () => {
    createShopper(USER_SPEC_V1);
    mint(CYCLING, USER_SPEC_V1);
    // While shopping running, a NEW standing fact (wool allergy) is captured into
    // the SHARED user_spec — minted alongside the running pack in one call.
    mint(RUNNING, USER_SPEC_V2);

    // Viewing niche A (cycling) surfaces the LATEST shared user_spec — the fact
    // added during niche B is already there. This is the cross-niche signal as a
    // native property of the agent-level user_spec, not a feature to build.
    const cycling = readAgentProfile(AGENT_ID, CYCLING.slug);
    expect(cycling.ok).toBe(true);
    if (!cycling.ok) return;
    expect(cycling.userSpec).toBe(USER_SPEC_V2);
    expect(cycling.userSpec).toContain("Allergic to wool");
    // There is ONE shared user_spec.md at the agent level — never one per domain.
    expect(existsSync(join(getAgentArtefactDir(AGENT_ID), "user_spec.md"))).toBe(true);
    expect(existsSync(join(domainDir(CYCLING.slug), "user_spec.md"))).toBe(false);
    expect(existsSync(join(domainDir(RUNNING.slug), "user_spec.md"))).toBe(false);
  });

  it("minting a SECOND domain leaves the FIRST domain's pack byte-for-byte untouched", () => {
    createShopper();
    mint(CYCLING);
    const cyclingBefore = walkFiles(domainDir(CYCLING.slug)).sort().map((rel) =>
      readFileSync(join(domainDir(CYCLING.slug), rel), "utf8"),
    );

    mint(RUNNING, USER_SPEC_V2);

    // The cycling pack is identical — a running mint touches only domains/running-shoes/.
    const cyclingAfter = walkFiles(domainDir(CYCLING.slug)).sort().map((rel) =>
      readFileSync(join(domainDir(CYCLING.slug), rel), "utf8"),
    );
    expect(cyclingAfter).toEqual(cyclingBefore);
    expect(readFileSync(join(domainDir(CYCLING.slug), "domain_spec.md"), "utf8")).toBe(
      CYCLING.domainSpec,
    );
    // Both domains are registered in the map.
    const domains = (readManifest()["domains"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(domains).sort()).toEqual([CYCLING.slug, RUNNING.slug].sort());
  });

  it("re-minting an EXISTING domain upserts its entry (updatedAt advances) without adding a sibling", () => {
    createShopper();
    mint(CYCLING);
    const first = (readManifest()["domains"] as Record<string, Record<string, unknown>>)[
      CYCLING.slug
    ]!;

    // Re-mint the same slug with a refreshed domain_spec (a per-query web refresh).
    mint({ ...CYCLING, domainSpec: CYCLING.domainSpec + "\n(refreshed this query)" });

    const domains = readManifest()["domains"] as Record<string, Record<string, unknown>>;
    // Still exactly one domain — an upsert by key, not a duplicate.
    expect(Object.keys(domains)).toEqual([CYCLING.slug]);
    // createdAt is preserved; the body is overwritten in place.
    expect(domains[CYCLING.slug]!["createdAt"]).toBe(first["createdAt"]);
    expect(readFileSync(join(domainDir(CYCLING.slug), "domain_spec.md"), "utf8")).toContain(
      "(refreshed this query)",
    );
  });
});

// ===========================================================================
// 2 — slug is a path segment: guarded exactly like agentId
// ===========================================================================

describe("mint — the slug is a path segment, validated BEFORE any join (write-nothing on a bad slug)", () => {
  it.each(["../escape", "road/cycling", "..", ".", "a/../b", "main", "Road-Cycling", ""])(
    "rejects slug %j with invalid_request(field=domain.slug) and writes NO domain pack",
    (badSlug) => {
      createShopper();
      const before = walkFiles(getAgentArtefactDir(AGENT_ID)).sort();
      const result = materializeProfile({
        agentId: AGENT_ID,
        name: "sil shopper",
        userSpec: USER_SPEC_V1,
        domain: { ...CYCLING, slug: badSlug },
      });
      expect(result.ok, `expected reject for ${JSON.stringify(badSlug)}`).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("domain.slug");
      // Nothing minted — the shopper's tree is unchanged, no domains/ leaf appeared.
      expect(walkFiles(getAgentArtefactDir(AGENT_ID)).sort()).toEqual(before);
      expect(existsSync(join(getAgentArtefactDir(AGENT_ID), "domains"))).toBe(false);
    },
  );

  it.each([
    ["name", { ...CYCLING, name: "   " }, "domain.name"],
    ["domainSpec", { ...CYCLING, domainSpec: "" }, "domain.domainSpec"],
    ["intentSpec", { ...CYCLING, intentSpec: "\t\n" }, "domain.intentSpec"],
    ["playbook", { ...CYCLING, playbook: "  " }, "domain.playbook"],
  ] as const)(
    "a blank domain field (%s) → invalid_request naming it, writes NO domain pack",
    (_label, badDomain, field) => {
      createShopper();
      const result = materializeProfile({
        agentId: AGENT_ID,
        name: "sil shopper",
        userSpec: USER_SPEC_V1,
        domain: badDomain,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe(field);
      expect(existsSync(join(getAgentArtefactDir(AGENT_ID), "domains"))).toBe(false);
    },
  );
});

// ===========================================================================
// 3 — atomicity one level deeper: fresh-leaf teardown + orphan invisibility
// ===========================================================================

describe("mint atomicity — a failed FIRST mint of a NEW domain tears down ONLY that leaf", () => {
  it("the agent dir, shared user_spec, and sibling domains all survive a failed new-domain mint", () => {
    createShopper(USER_SPEC_V1);
    mint(CYCLING); // a sibling that must survive

    // Force a failure AFTER the new domain's pack is written but BEFORE the
    // profile.json upsert: replace the shared user_spec.md with a DIRECTORY, so
    // the store's atomic rewrite of it fails (rename-over-a-dir → EISDIR). This is
    // perm-independent (works as root), unlike a chmod-based block.
    const userSpecPath = join(getAgentArtefactDir(AGENT_ID), "user_spec.md");
    rmSync(userSpecPath, { force: true });
    mkdirSync(userSpecPath);
    writeFileSync(join(userSpecPath, "occupant"), "make it non-empty");

    const result = materializeProfile({
      agentId: AGENT_ID,
      name: "sil shopper",
      userSpec: USER_SPEC_V2,
      domain: RUNNING, // a NEW domain (not yet in the map)
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("persistence_failed");

    // The freshly-created NEW-domain leaf is torn down (it was ours, just created).
    expect(existsSync(domainDir(RUNNING.slug))).toBe(false);
    // The agent dir survives, and the sibling domain's pack is intact.
    expect(existsSync(getAgentArtefactDir(AGENT_ID))).toBe(true);
    expect(readFileSync(join(domainDir(CYCLING.slug), "domain_spec.md"), "utf8")).toBe(
      CYCLING.domainSpec,
    );
    // The manifest was NEVER rewritten — the failed new domain is unregistered.
    const domains = (readManifest()["domains"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(domains)).toEqual([CYCLING.slug]);
    expect(domains[RUNNING.slug]).toBeUndefined();
  });

  it("a domains-path blocked by a regular file → persistence_failed, nothing partial, manifest unchanged", () => {
    createShopper();
    mint(CYCLING);
    // Block the domains/ subtree with a regular file where the running leaf's
    // parent chain expects a dir is impossible here; instead block the specific
    // new leaf path with a FILE so mkdir(domains/<slug>) throws ENOTDIR.
    const leaf = domainDir(RUNNING.slug);
    mkdirSync(join(getAgentArtefactDir(AGENT_ID), "domains"), { recursive: true });
    writeFileSync(leaf, "i am a file where the running leaf must go");

    const result = materializeProfile({
      agentId: AGENT_ID,
      name: "sil shopper",
      userSpec: USER_SPEC_V1,
      domain: RUNNING,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("persistence_failed");
    // The blocking file is untouched; the cycling sibling + manifest are intact.
    expect(statSync(leaf).isFile()).toBe(true);
    const domains = (readManifest()["domains"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(domains)).toEqual([CYCLING.slug]);
  });
});

describe("mint atomicity — an ORPHANED leaf (crash before the profile.json write) is invisible to readers", () => {
  it("a domains/<slug>/ leaf not referenced by the manifest reads as not_found and never lists", () => {
    createShopper();
    mint(CYCLING);

    // Simulate a crash AFTER the bodies were written but BEFORE the profile.json
    // upsert: fabricate a fully-populated leaf the manifest does NOT reference.
    const zombie = domainDir("zombie-niche");
    mkdirSync(zombie, { recursive: true });
    writeFileSync(join(zombie, "domain_spec.md"), "# orphan\nnever registered");
    writeFileSync(join(zombie, "intent_spec.md"), "# orphan");
    writeFileSync(join(zombie, "playbook.md"), "# orphan");

    // Manifest-gated: an unreferenced leaf is invisible.
    const read = readAgentProfile(AGENT_ID, "zombie-niche");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");

    // It never appears in the shopper's domain list either (the map is the truth).
    const list = listAgentProfiles();
    const shopper = list.shoppers.find((s) => s.agentId === AGENT_ID);
    expect(shopper).toBeDefined();
    expect(shopper!.domains.map((d) => d.slug)).toEqual([CYCLING.slug]);

    // …nor in the shopper overview's domain index.
    const overview = readAgentProfile(AGENT_ID);
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.domains.map((d) => d.slug)).toEqual([CYCLING.slug]);
  });
});

// ===========================================================================
// 4 — fail-closed reads: a missing required body → not_found (never partial)
// ===========================================================================

describe("readAgentProfile(agentId, slug) — fail-closed on any missing required body", () => {
  it("the shared user_spec body is GONE → not_found for the overview AND for a domain read", () => {
    createShopper();
    mint(CYCLING);
    rmSync(join(getAgentArtefactDir(AGENT_ID), "user_spec.md"), { force: true });

    const overview = readAgentProfile(AGENT_ID);
    expect(overview.ok).toBe(false);
    if (overview.ok) return;
    expect(overview.kind).toBe("not_found");

    const domain = readAgentProfile(AGENT_ID, CYCLING.slug);
    expect(domain.ok).toBe(false);
    if (domain.ok) return;
    expect(domain.kind).toBe("not_found");
  });

  it.each(["domain_spec.md", "intent_spec.md", "playbook.md"])(
    "a domain whose %s body is GONE → not_found (never a half pack)",
    (file) => {
      createShopper();
      mint(CYCLING);
      rmSync(join(domainDir(CYCLING.slug), file), { force: true });
      const read = readAgentProfile(AGENT_ID, CYCLING.slug);
      expect(read.ok).toBe(false);
      if (read.ok) return;
      expect(read.kind).toBe("not_found");
    },
  );

  it("a slug NOT in the domains map → not_found (manifest-gated), never a filesystem guess", () => {
    createShopper();
    mint(CYCLING);
    const read = readAgentProfile(AGENT_ID, "never-minted");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.kind).toBe("not_found");
  });

  it("a malformed/traversal domainSlug → invalid_request(field=domainSlug), reads nothing", () => {
    createShopper();
    mint(CYCLING);
    for (const bad of ["../escape", "road/cycling", "..", "main", "Road-Cycling"]) {
      const read = readAgentProfile(AGENT_ID, bad);
      expect(read.ok, `expected reject for ${JSON.stringify(bad)}`).toBe(false);
      if (read.ok) return;
      expect(read.kind).toBe("invalid_request");
      if (read.kind !== "invalid_request") return;
      expect(read.field).toBe("domainSlug");
    }
  });
});

// ===========================================================================
// 5 — empty-domains shopper reads as HEALTHY (not_found is the wrong answer)
// ===========================================================================

describe("readAgentProfile — a freshly-created shopper with `domains: {}` is HEALTHY, not not_found", () => {
  it("the overview returns ok with the shared user_spec + an EMPTY domain index", () => {
    createShopper(USER_SPEC_V1);
    const overview = readAgentProfile(AGENT_ID);
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.userSpec).toBe(USER_SPEC_V1);
    expect(overview.domains).toEqual([]);
  });
});
