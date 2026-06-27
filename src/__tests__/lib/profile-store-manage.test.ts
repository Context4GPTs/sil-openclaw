/**
 * UNIT — list / read / remove store primitives after the single-multi-domain
 * shopper reshape (tier: unit, real temp dir via the SIL_DATA_DIR override, no
 * network, no host).
 *
 * Card: single-multi-domain-sil-shopper — Slice 1. The lifecycle primitives shift
 * from "experts" to "DOMAINS" semantics — they now manage the ONE shopper's
 * domain packs, not separate per-niche experts:
 *
 *   listAgentProfiles()                  — enumerate the shopper(s) + each one's
 *                                          domain index from its `domains` map.
 *   readAgentProfile(agentId, slug?)     — slug ⇒ that domain's 3 bodies + the
 *                                          SHARED user_spec; no slug ⇒ the shopper
 *                                          overview (identity + shared user_spec +
 *                                          the domain index).
 *   removeAgentArtefacts(agentId, slug)  — remove exactly ONE domain leaf +
 *                                          de-register domains[slug]; the shopper
 *                                          and shared user_spec survive. `slug` is
 *                                          REQUIRED (no omit-deletes-everything).
 *
 * The invariants pinned here:
 *   LIST   1. empty/absent store → ok with empty shoppers (normal).
 *          2. a shopper with N domains → its identity + N domain summaries
 *             (slug, name, createdAt, updatedAt) from the `domains` map.
 *          3. empty `domains` → the shopper still lists, with an empty domain
 *             list (NOT not_found / NOT unreadable).
 *          4. one corrupt profile.json → that shopper in unreadable[], the rest
 *             still list (never aborts/throws).
 *   READ   5. overview (no slug) → identity + shared user_spec + the domain index.
 *          6. per-domain (slug) → the 3 domain bodies + the shared user_spec.
 *          7. unknown agentId → not_found; traversal agentId → invalid_request.
 *   REMOVE 8. removes exactly one leaf + de-registers it; sibling + shared
 *             user_spec + the shopper survive.
 *          9. removing the LAST domain leaves a healthy `domains: {}` shopper
 *             (never deletes the agent dir / the domains parent / the shopper).
 *         10. absent slug → not_found (idempotent); a missing/blank slug →
 *             invalid_request(field=domainSlug), deletes nothing.
 *         11. traversal/main slug → invalid_request(field=domainSlug), deletes
 *             nothing; bad agentId → invalid_request(field=agentId).
 *         12. a genuine rmSync failure → persistence_failed with <dir>: <cause>.
 *   IDENTITY 13. none of the three read/write a token.
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
  readdirSync,
  readFileSync,
  mkdirSync,
  statSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeProfile,
  listAgentProfiles,
  readAgentProfile,
  removeAgentArtefacts,
  getAgentArtefactDir,
  type ProfileSpec,
} from "../../lib/profile-store.js";
import { getDataDir, getTokensPath } from "../../lib/credentials.js";

let dataDir: string;
let priorSilDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sil-shopper-manage-"));
  priorSilDataDir = process.env["SIL_DATA_DIR"];
  process.env["SIL_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (priorSilDataDir === undefined) delete process.env["SIL_DATA_DIR"];
  else process.env["SIL_DATA_DIR"] = priorSilDataDir;
  try {
    chmodSync(dataDir, 0o700);
    const agents = join(dataDir, "agents");
    if (existsSync(agents)) {
      chmodSync(agents, 0o700);
      for (const e of readdirSync(agents)) {
        const a = join(agents, e);
        try {
          chmodSync(a, 0o700);
          const dom = join(a, "domains");
          if (existsSync(dom)) {
            chmodSync(dom, 0o700);
            for (const d of readdirSync(dom)) {
              try {
                chmodSync(join(dom, d), 0o700);
              } catch {
                /* best-effort */
              }
            }
          }
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    /* best-effort */
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const SHOPPER = "sil-shopper";
const USER_SPEC =
  "# User spec (shared)\n- Ships to Berlin 10115.\nHARD-NO: leather (ethics).";

function pack(slug: string, name: string): NonNullable<ProfileSpec["domain"]> {
  return {
    slug,
    name,
    domainSpec: `# Domain spec — ${name}\nResearched mechanics.`,
    intentSpec: `# Intent spec — ${name}\nDecomposition dimensions.`,
    playbook: `# Taste — ${name}\nSeeded preferences.`,
  };
}

/** Create the shopper with `agentId`, then mint each (slug → name) domain. */
function makeShopper(
  agentId: string,
  domains: ReadonlyArray<readonly [string, string]> = [],
  userSpec = USER_SPEC,
): void {
  const created = materializeProfile({ agentId, name: `Shopper ${agentId}`, userSpec });
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
  for (const [slug, name] of domains) {
    const r = materializeProfile({ agentId, name: `Shopper ${agentId}`, userSpec, domain: pack(slug, name) });
    if (!r.ok) throw new Error(`mint ${slug} failed: ${JSON.stringify(r)}`);
  }
}

function domainDir(slug: string, agentId = SHOPPER): string {
  return join(getAgentArtefactDir(agentId), "domains", slug);
}

function readManifest(agentId = SHOPPER): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(getAgentArtefactDir(agentId), "profile.json"), "utf8"),
  ) as Record<string, unknown>;
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
// listAgentProfiles
// ===========================================================================

describe("listAgentProfiles — empty/absent store is a normal, successful empty listing", () => {
  it("absent agents/ dir → empty shoppers, empty unreadable (not an error)", () => {
    expect(existsSync(join(getDataDir(), "agents"))).toBe(false);
    const result = listAgentProfiles();
    expect(result.shoppers).toEqual([]);
    expect(result.unreadable).toEqual([]);
  });
});

describe("listAgentProfiles — a shopper with N domains lists its identity + domain index", () => {
  it("returns the shopper identity + each domain's slug/name/createdAt/updatedAt from the map", () => {
    makeShopper(SHOPPER, [
      ["road-cycling", "Road cycling"],
      ["running-shoes", "Running shoes"],
    ]);

    const result = listAgentProfiles();
    expect(result.unreadable).toEqual([]);
    const shopper = result.shoppers.find((s) => s.agentId === SHOPPER);
    expect(shopper).toBeDefined();
    expect(shopper!.name).toBe(`Shopper ${SHOPPER}`);

    const byId = new Map(shopper!.domains.map((d) => [d.slug, d]));
    expect([...byId.keys()].sort()).toEqual(["road-cycling", "running-shoes"]);
    expect(byId.get("road-cycling")!.name).toBe("Road cycling");
    expect(typeof byId.get("road-cycling")!.createdAt).toBe("string");
    expect(typeof byId.get("road-cycling")!.updatedAt).toBe("string");
  });

  it("an empty-`domains` shopper still lists, with an EMPTY domain list (not not_found, not unreadable)", () => {
    makeShopper(SHOPPER, []); // created, never shopped
    const result = listAgentProfiles();
    expect(result.unreadable).toEqual([]);
    const shopper = result.shoppers.find((s) => s.agentId === SHOPPER);
    expect(shopper).toBeDefined();
    expect(shopper!.domains).toEqual([]);
  });
});

describe("listAgentProfiles — one corrupt manifest never blinds the user to the rest", () => {
  it("a healthy shopper + a corrupt profile.json → healthy listed, broken in unreadable[]", () => {
    makeShopper("healthy", [["a-niche", "A niche"]]);
    makeShopper("broken", []);
    const brokenManifest = join(getAgentArtefactDir("broken"), "profile.json");
    chmodSync(brokenManifest, 0o600);
    writeFileSync(brokenManifest, "{ not valid json ");

    const result = listAgentProfiles();
    expect(result.shoppers.map((s) => s.agentId)).toEqual(["healthy"]);
    expect(result.unreadable.map((u) => u.agentId)).toContain("broken");
    expect(typeof result.unreadable[0]!.error).toBe("string");
    expect(result.unreadable[0]!.error.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// readAgentProfile — overview vs per-domain
// ===========================================================================

describe("readAgentProfile — overview (no slug): identity + shared user_spec + domain index", () => {
  it("returns the shopper identity, the SHARED user_spec body, and the domain index — no bodies", () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]], USER_SPEC);
    const overview = readAgentProfile(SHOPPER);
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.agentId).toBe(SHOPPER);
    expect(overview.userSpec).toBe(USER_SPEC);
    expect(overview.domains.map((d) => d.slug)).toEqual(["road-cycling"]);
    expect(overview.profilePath).toBe(join(getAgentArtefactDir(SHOPPER), "profile.json"));
  });
});

describe("readAgentProfile — per-domain (slug): the 3 domain bodies + the shared user_spec", () => {
  it("returns domainSpec + intentSpec + playbook (the pack) AND the shared user_spec", () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]], USER_SPEC);
    const read = readAgentProfile(SHOPPER, "road-cycling");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.slug).toBe("road-cycling");
    expect(read.domainSpec).toBe("# Domain spec — Road cycling\nResearched mechanics.");
    expect(read.intentSpec).toBe("# Intent spec — Road cycling\nDecomposition dimensions.");
    expect(read.playbook).toBe("# Taste — Road cycling\nSeeded preferences.");
    // The user_spec read with a domain is the SHARED, agent-level one.
    expect(read.userSpec).toBe(USER_SPEC);
  });
});

describe("readAgentProfile — graceful failures", () => {
  it("an unknown agentId → not_found naming it, no throw", () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    const result = readAgentProfile("no-such-shopper");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("not_found");
    if (result.kind !== "not_found") return;
    expect(result.agentId).toBe("no-such-shopper");
  });

  it.each(["../escape", "shop/per", "..", ".", "main", "Sil-Shopper", ""])(
    "a traversal/main/malformed agentId %j → invalid_request(field=agentId), reads nothing",
    (bad) => {
      const result = readAgentProfile(bad);
      expect(result.ok, `expected reject for ${JSON.stringify(bad)}`).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("agentId");
    },
  );
});

// ===========================================================================
// removeAgentArtefacts(agentId, slug) — one domain leaf, de-registered, scoped
// ===========================================================================

describe("removeAgentArtefacts — removes exactly ONE domain leaf + de-registers it", () => {
  it("the target leaf is gone + de-registered; the sibling domain + shared user_spec + shopper survive", () => {
    makeShopper(SHOPPER, [
      ["road-cycling", "Road cycling"],
      ["running-shoes", "Running shoes"],
    ]);
    expect(existsSync(domainDir("road-cycling"))).toBe(true);

    const result = removeAgentArtefacts(SHOPPER, "road-cycling");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The leaf is gone…
    expect(existsSync(domainDir("road-cycling"))).toBe(false);
    // …and de-registered from the manifest, while the sibling stays.
    const domains = (readManifest()["domains"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(domains)).toEqual(["running-shoes"]);
    expect(existsSync(domainDir("running-shoes"))).toBe(true);
    // The shopper + the SHARED user_spec are untouched (artefact-only, scoped).
    expect(existsSync(join(getAgentArtefactDir(SHOPPER), "user_spec.md"))).toBe(true);
    expect(readFileSync(join(getAgentArtefactDir(SHOPPER), "user_spec.md"), "utf8")).toBe(
      USER_SPEC,
    );
  });

  it("removing the LAST domain leaves a healthy `domains: {}` shopper (never deletes the shopper)", () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    const result = removeAgentArtefacts(SHOPPER, "road-cycling");
    expect(result.ok).toBe(true);

    // The agent dir + shared user_spec + manifest survive; the domains map is now {}.
    expect(existsSync(getAgentArtefactDir(SHOPPER))).toBe(true);
    expect(existsSync(join(getAgentArtefactDir(SHOPPER), "user_spec.md"))).toBe(true);
    expect((readManifest()["domains"] ?? {})).toEqual({});
    // The shopper still reads back healthy (empty domain index, not not_found).
    const overview = readAgentProfile(SHOPPER);
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.domains).toEqual([]);
  });
});

describe("removeAgentArtefacts — required slug, idempotent, fail-closed on a bad slug/id", () => {
  it("absent slug → not_found (idempotent: a re-run is also not_found), deletes nothing", () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    const first = removeAgentArtefacts(SHOPPER, "never-minted");
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.kind).toBe("not_found");
    // The real domain is untouched.
    expect(existsSync(domainDir("road-cycling"))).toBe(true);
    const second = removeAgentArtefacts(SHOPPER, "never-minted");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.kind).toBe("not_found");
  });

  it("a MISSING/blank domainSlug → invalid_request(field=domainSlug), deletes nothing (no omit-deletes-everything)", () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    for (const missing of ["", undefined as unknown as string]) {
      const result = removeAgentArtefacts(SHOPPER, missing);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("domainSlug");
      // The whole shopper + its domain are untouched — an absent slug deletes NOTHING.
      expect(existsSync(domainDir("road-cycling"))).toBe(true);
      expect(existsSync(getAgentArtefactDir(SHOPPER))).toBe(true);
    }
  });

  it.each(["../escape", "road/cycling", "..", ".", "a/../b", "main", "Road-Cycling"])(
    "a traversal/main slug %j → invalid_request(field=domainSlug), deletes nothing",
    (bad) => {
      makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
      const before = walkFiles(getAgentArtefactDir(SHOPPER)).sort();
      const result = removeAgentArtefacts(SHOPPER, bad);
      expect(result.ok, `expected reject for ${JSON.stringify(bad)}`).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("invalid_request");
      if (result.kind !== "invalid_request") return;
      expect(result.field).toBe("domainSlug");
      expect(walkFiles(getAgentArtefactDir(SHOPPER)).sort()).toEqual(before);
    },
  );

  it("a bad agentId → invalid_request(field=agentId), deletes nothing", () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    const result = removeAgentArtefacts("../escape", "road-cycling");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_request");
    if (result.kind !== "invalid_request") return;
    expect(result.field).toBe("agentId");
    expect(existsSync(domainDir("road-cycling"))).toBe(true);
  });
});

describe("removeAgentArtefacts — a genuine rmSync failure returns persistence_failed, never throws", () => {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(asRoot)(
    "a non-writable domains/ parent (rmSync of the leaf fails EACCES) → persistence_failed with <dir>: <cause>",
    () => {
      makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
      const leaf = domainDir("road-cycling");
      const domainsParent = join(getAgentArtefactDir(SHOPPER), "domains");
      // Unlinking the leaf needs WRITE on its PARENT (domains/). Make it read+exec.
      chmodSync(domainsParent, 0o500);

      const result = removeAgentArtefacts(SHOPPER, "road-cycling");
      chmodSync(domainsParent, 0o700); // restore immediately for assertions + cleanup

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("persistence_failed");
      if (result.kind !== "persistence_failed") return;
      expect(result.error).toContain(leaf);
      expect(result.error).toMatch(/.+: .+/);
      expect(result.recovery).toBe("fix_data_dir");
      // The leaf was NOT removed (the delete genuinely failed) — structured, not thrown.
      expect(existsSync(leaf)).toBe(true);
    },
  );
});

// ===========================================================================
// Identity boundary — none of the three read or write a token
// ===========================================================================

describe("list/read/remove — no identity coupling (getTokensPath never appears)", () => {
  it("none of the three create the tokens path across a full list→read→remove cycle", () => {
    makeShopper(SHOPPER, [["road-cycling", "Road cycling"]]);
    listAgentProfiles();
    readAgentProfile(SHOPPER, "road-cycling");
    removeAgentArtefacts(SHOPPER, "road-cycling");
    expect(existsSync(getTokensPath())).toBe(false);
    expect(statSync(getDataDir()).isDirectory()).toBe(true);
  });
});
